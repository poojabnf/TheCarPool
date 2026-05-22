import os
import json
import re
from anthropic import Anthropic

def parse_user_intent(transcript: str) -> dict:
    """
    Translates user voice transcripts into structured JSON payloads:
    { "intent": "CONFIRM" | "DELAY" | "CANCEL" | "UNKNOWN", "delay_minutes": int }
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    
    if not api_key:
        print("ANTHROPIC_API_KEY missing. Running local regex-based intent extraction fallback.")
        return run_local_regex_parser(transcript)

    try:
        client = Anthropic(api_key=api_key)
        
        prompt = f"""
        Analyze this voice call transcript from a carpool rider confirming their ride:
        "{transcript}"
        
        Classify the intent into one of these types:
        - CONFIRM (if they are still coming, saying yes, confirm, sure, definitely, etc.)
        - DELAY (if they want to delay, push time, request late pickup, wait for them, etc.)
        - CANCEL (if they want to cancel, decline, not coming, skip, drop the ride, etc.)
        - UNKNOWN (if ambiguous or unrecognized)
        
        If they requested a delay, extract the number of minutes they specified (default to 0).
        
        Respond ONLY with a valid JSON object matching this schema:
        {{
            "intent": "CONFIRM" | "DELAY" | "CANCEL" | "UNKNOWN",
            "delay_minutes": integer
        }}
        """
        
        message = client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=100,
            temperature=0.0,
            system="You are an expert NLP parser extracting slots from carpooling phone confirmation transcripts.",
            messages=[
                {"role": "user", "content": prompt}
            ]
        )
        
        raw_text = message.content[0].text.strip()
        # Parse output safely
        data = json.loads(raw_text)
        return data
    except Exception as e:
        print(f"Claude NLU API failure: {e}. Falling back to regex parser.")
        return run_local_regex_parser(transcript)

def run_local_regex_parser(transcript: str) -> dict:
    """
    Regex fallback for out-of-the-box execution when API keys are absent.
    """
    text = transcript.lower()
    
    # 1. Check for cancel intents
    cancel_keywords = ["cancel", "not coming", "skip", "decline", "drop", "abort", "no can do"]
    if any(keyword in text for keyword in cancel_keywords):
        return {"intent": "CANCEL", "delay_minutes": 0}
        
    # 2. Check for delay intents
    delay_keywords = ["delay", "late", "minutes", "mins", "wait", "hold", "postpone"]
    if any(keyword in text for keyword in delay_keywords):
        # Extract number of minutes if available
        minutes = 0
        match = re.search(r'(\d+)\s*(minute|min|hour|hr)', text)
        if match:
            minutes = int(match.group(1))
            # handle hour to minute conversion
            if "hour" in match.group(2) or "hr" in match.group(2):
                minutes *= 60
        else:
            # check direct lone digits
            digit_match = re.search(r'\b(\d+)\b', text)
            if digit_match:
                minutes = int(digit_match.group(1))
        
        # Default to a 10 minute delay if no number was found but keyword matched
        if minutes == 0:
            minutes = 10
            
        return {"intent": "DELAY", "delay_minutes": minutes}
        
    # 3. Check for confirm intents
    confirm_keywords = ["yes", "yeah", "sure", "confirm", "coming", "on my way", "join", "definitely", "ok", "okay"]
    if any(keyword in text for keyword in confirm_keywords):
        return {"intent": "CONFIRM", "delay_minutes": 0}
        
    return {"intent": "UNKNOWN", "delay_minutes": 0}
