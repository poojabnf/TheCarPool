from fastapi import APIRouter, Request, Form, Response
from twilio.twiml.voice_response import VoiceResponse, Gather
from app.services.claude_parser import parse_user_intent
import urllib.parse

router = APIRouter()

@router.post("/incoming")
async def voice_incoming(request: Request):
    """
    Twilio voice call initiation webhook.
    Greets the rider and gathers speech input.
    """
    response = VoiceResponse()
    
    # 1. ElevenLabs TTS Voice configuration (Hindi-English accent)
    # Twilio allows <Play> with ElevenLabs streamed TTS files, fallback to default voice
    gather = Gather(
        input="speech",
        action="/voice/gather",
        method="POST",
        speech_timeout="auto",
        language="en-IN" # Indian English / Hindi mix support
    )
    
    gather.say(
        "Namaste! This is TheCarPool auto-confirmation. "
        "We are confirming your commute ride to Cyber City at 8:30 AM tomorrow. "
        "Are you still joining this ride? Please say yes, request a delay, or cancel.",
        voice="Polly.Aditi",
        language="en-IN"
    )
    
    response.append(gather)
    # Redirect back to incoming if they don't say anything
    response.redirect("/voice/incoming")
    
    return Response(content=str(response), media_type="application/xml")

@router.post("/gather")
async def voice_gather(SpeechResult: str = Form(None)):
    """
    Webhook target executing Claude NLU logic to determine rider response slots.
    """
    response = VoiceResponse()
    
    if not SpeechResult:
        response.say("Sorry, I didn't hear anything. Please try again.", voice="Polly.Aditi", language="en-IN")
        response.redirect("/voice/incoming")
        return Response(content=str(response), media_type="application/xml")
        
    print(f"Twilio Speech Result Received: {SpeechResult}")
    
    # Parse transcript using Claude NLU
    nlu_slots = parse_user_intent(SpeechResult)
    intent = nlu_slots.get("intent")
    delay = nlu_slots.get("delay_minutes", 0)
    
    if intent == "CONFIRM":
        response.say(
            "Fantastic! Your seat remains locked. "
            "Your driver, Rajesh, will pick you up at Sector 56 HDFC bank at 8:30 AM. "
            "Safe travels!",
            voice="Polly.Aditi",
            language="en-IN"
        )
        response.hangup()
        
    elif intent == "DELAY":
        response.say(
            f"Understood. You requested a delay of {delay} minutes. "
            "We have updated your pickup ETA and notified Rajesh. "
            "Thank you for informing us!",
            voice="Polly.Aditi",
            language="en-IN"
        )
        # Here we would asynchronously patch the backend DB booking ETA
        response.hangup()
        
    elif intent == "CANCEL":
        response.say(
            "Understood. Your booking has been cancelled, "
            "and your escrow lock has been released. "
            "We hope to match you on another pool soon.",
            voice="Polly.Aditi",
            language="en-IN"
        )
        # Here we would trigger backend escrow refund
        response.hangup()
        
    else:
        # Fallback if Claude couldn't map intent
        gather = Gather(
            input="speech",
            action="/voice/gather",
            method="POST",
            speech_timeout="auto",
            language="en-IN"
        )
        gather.say(
            "I could not quite verify your confirmation status. "
            "Please state clearly: yes I am coming, cancel my ride, or delay the trip.",
            voice="Polly.Aditi",
            language="en-IN"
        )
        response.append(gather)
        
    return Response(content=str(response), media_type="application/xml")
