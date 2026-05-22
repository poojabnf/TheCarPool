import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

load_dotenv()

app = FastAPI(
    title="TheCarPool AI Voice & Match Service",
    description="Twilio TwiML integration endpoints backed by Claude NLU and ElevenLabs TTS",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Import and register Twilio router
from app.routes.twilio_voice import router as twilio_router
app.include_router(twilio_router, prefix="/voice", tags=["Voice Webhooks"])

@app.get("/health")
def health_check():
    return {"status": "OK", "service": "TheCarPool AI Engine"}

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=True)
