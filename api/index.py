"""
Vercel Serverless Function Entry Point

This file is the ASGI handler that Vercel's @vercel/python builder
invokes. It simply re-exports the FastAPI `app` from the backend.
"""
import sys
import os

# Ensure the project root is on sys.path so 'backend.app...' imports work
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.app.main import app
