import os
import shutil
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, UploadFile, File, HTTPException, Form, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from rag_engine import RAGEngine

# Load environment variables
dotenv_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
load_dotenv(dotenv_path=dotenv_path)

app = FastAPI(title="NeuroLens Backend", description="FastAPI Server for NeuroLens Document RAG System")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict to frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Allow Chrome Private Network Access (PNA) for local backend execution from deployed HTTPS sites
@app.middleware("http")
async def add_private_network_header(request: Request, call_next):
    response = await call_next(request)
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response

# Initialize RAG Engine
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
rag_engine = RAGEngine(index_dir="faiss_index")

class QueryRequest(BaseModel):
    query: str
    history: Optional[List[Dict[str, Any]]] = []
    provider: str
    apiKey: str
    modelName: str
    temperature: float = 0.3
    k: int = 5

class TTSRequest(BaseModel):
    text: str
    language_code: Optional[str] = "en-IN"
    speaker: Optional[str] = "shubh"

@app.get("/")
def read_root():
    return {"status": "online", "message": "NeuroLens Backend API is running."}

@app.post("/api/upload")
async def upload_files(files: List[UploadFile] = File(...)):
    """Uploads one or multiple documents, saves them temporarily, and indexes them."""
    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")

    saved_paths = []
    filenames = []
    
    try:
        print(f"📥 Received upload request for files: {[f.filename for f in files]}")
        for file in files:
            # Clean filename
            safe_name = os.path.basename(file.filename)
            file_path = os.path.join(UPLOAD_DIR, safe_name)
            print(f"  Saving temporary file: {safe_name} to {file_path}")
            
            # Save file content
            with open(file_path, "wb") as f:
                shutil.copyfileobj(file.file, f)
                
            saved_paths.append(file_path)
            filenames.append(safe_name)

        # Index the files in the RAG Engine
        print(f"  Indexing files in FAISS vector store...")
        success = rag_engine.index_files(saved_paths, filenames)
        
        if not success:
            print(f"  ⚠️ Indexing returned success=False. No documents could be parsed.")
            raise HTTPException(status_code=400, detail="Failed to parse and index documents. Make sure the files are not empty and are valid PDF, DOCX, or TXT formats.")
            
        print(f"  Successfully indexed {len(filenames)} files.")
        return {
            "message": f"Successfully indexed {len(filenames)} file(s).",
            "documents": rag_engine.uploaded_files
        }
    
    except HTTPException as he:
        raise he
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error indexing documents: {str(e)}")
    
    finally:
        # Clean up temporary saved files to keep server lightweight
        for path in saved_paths:
            if os.path.exists(path):
                try:
                    os.remove(path)
                except Exception:
                    pass

@app.post("/api/query")
async def query_documents(request: QueryRequest):
    """Processes query against the vector store and sends structured prompt to target LLM."""
    try:
        response = rag_engine.query_llm(
            query=request.query,
            history=request.history,
            provider=request.provider,
            api_key=request.apiKey,
            model_name=request.modelName,
            temperature=request.temperature,
            k=request.k
        )
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process query: {str(e)}")

@app.post("/api/tts")
async def text_to_speech(request: TTSRequest):
    """Converts text to speech using ElevenLabs API with model eleven_v3."""
    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        api_key = api_key
    
    text_clean = request.text.strip()
    if not text_clean:
        raise HTTPException(status_code=400, detail="Text cannot be empty.")
    
    # Working default voices mapping for the free tier key
    WORKING_VOICES = {
        "antoni": "ErXwobaYiN019PkySvjV",  # Male - warm, professional (Best default male)
        "bella": "EXAVITQu4vr4xnSDxMaL",    # Female - clear, natural (Best default female)
        "adam": "pNInz6obpgDQGcFmaJgB",     # Male - deep, narrative
        "arnold": "VR6AewLTigWG4xSOukaG",   # Male - authoritative
        "charlie": "IKne3meq5aSn9XLyUdCD"   # Male - casual
    }
    
    # Select voice based on speaker preference
    speaker_preference = (request.speaker or "").lower()
    voice_id = WORKING_VOICES["antoni"] # Default best voice (Antoni)
    
    if speaker_preference in WORKING_VOICES:
        voice_id = WORKING_VOICES[speaker_preference]
    elif "female" in speaker_preference or "woman" in speaker_preference or "girl" in speaker_preference:
        voice_id = WORKING_VOICES["bella"]
    elif "male" in speaker_preference or "man" in speaker_preference or "boy" in speaker_preference:
        voice_id = WORKING_VOICES["antoni"]
        
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    headers = {
        "xi-api-key": api_key,
        "Content-Type": "application/json"
    }
    
    data = {
        "text": text_clean,
        "model_id": "eleven_v3",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75
        }
    }
    
    try:
        import urllib.request
        import json
        import base64
        
        req = urllib.request.Request(
            url, 
            data=json.dumps(data).encode("utf-8"), 
            headers=headers, 
            method="POST"
        )
        with urllib.request.urlopen(req) as response:
            audio_bytes = response.read()
            # Encode audio bytes to base64
            audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")
            return {"audio": audio_base64}
    except Exception as e:
        print(f"Error in ElevenLabs TTS: {e}")
        error_details = str(e)
        if hasattr(e, "read"):
            try:
                error_body = e.read().decode("utf-8")
                print(f"ElevenLabs API Error Body: {error_body}")
                error_details = error_body
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=f"ElevenLabs TTS Error: {error_details}")

@app.get("/api/documents")
async def get_documents():
    """Lists all currently indexed document filenames."""
    return {"documents": rag_engine.uploaded_files}

@app.post("/api/clear")
async def clear_database():
    """Clears the local vector store index and uploads log."""
    try:
        rag_engine.clear()
        # Clean uploads folder just in case
        if os.path.exists(UPLOAD_DIR):
            shutil.rmtree(UPLOAD_DIR)
            os.makedirs(UPLOAD_DIR, exist_ok=True)
        return {"message": "NeuroLens vector database and indexed documents cleared successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error clearing database: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
