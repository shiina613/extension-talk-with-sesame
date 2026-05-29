"""Minimal streaming WebSocket STT server using sherpa-onnx.

Accepts binary PCM int16 audio at 16kHz mono via WebSocket.
Returns JSON text frames with recognition results.
Send text "Done" to signal end of stream.
"""

import argparse
import asyncio
import json
import logging

import numpy as np
import sherpa_onnx
import websockets

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("stt-server")


def get_stream_text(recognizer: sherpa_onnx.OnlineRecognizer, stream) -> str:
    """sherpa-onnx may return str or a result object with .text depending on version."""
    result = recognizer.get_result(stream)
    if isinstance(result, str):
        return result.strip()
    return result.text.strip()


def create_recognizer(args) -> sherpa_onnx.OnlineRecognizer:
    return sherpa_onnx.OnlineRecognizer.from_transducer(
        encoder=args.encoder,
        decoder=args.decoder,
        joiner=args.joiner,
        tokens=args.tokens,
        num_threads=args.num_threads,
        sample_rate=16000,
        feature_dim=80,
        decoding_method="greedy_search",
        enable_endpoint_detection=True,
        # Less aggressive cuts — tab audio is noisy; reduces "ERST" / "YEARS" fragment splits
        rule1_min_trailing_silence=3.6,
        rule2_min_trailing_silence=2.0,
        rule3_min_utterance_length=35,
    )


async def handle_client(websocket, recognizer: sherpa_onnx.OnlineRecognizer):
    """Handle a single WebSocket client connection."""
    stream = recognizer.create_stream()
    last_segment = 0
    last_text = ""

    try:
        async for message in websocket:
            if isinstance(message, str):
                if message.strip().lower() == "done":
                    # End of stream signal
                    tail_paddings = np.zeros(int(16000 * 0.3), dtype=np.float32)
                    stream.accept_waveform(16000, tail_paddings)
                    while recognizer.is_ready(stream):
                        recognizer.decode_stream(stream)

                    text = get_stream_text(recognizer, stream)
                    if text:
                        response = {
                            "text": text,
                            "segment": last_segment,
                            "is_final": True,
                        }
                        await websocket.send(json.dumps(response))
                    break
            elif isinstance(message, bytes):
                # Binary PCM int16 data
                samples = np.frombuffer(message, dtype=np.int16).astype(np.float32) / 32768.0
                stream.accept_waveform(16000, samples)

                while recognizer.is_ready(stream):
                    recognizer.decode_stream(stream)

                is_endpoint = recognizer.is_endpoint(stream)
                text = get_stream_text(recognizer, stream)

                if text and text != last_text:
                    response = {
                        "text": text,
                        "segment": last_segment,
                        "is_final": False,
                    }
                    await websocket.send(json.dumps(response))
                    last_text = text

                if is_endpoint and text:
                    response = {
                        "text": text,
                        "segment": last_segment,
                        "is_final": True,
                    }
                    await websocket.send(json.dumps(response))
                    last_segment += 1
                    last_text = ""
                    recognizer.reset(stream)
    except websockets.exceptions.ConnectionClosed:
        logger.info("Client disconnected")
    except Exception as e:
        logger.error(f"Error handling client: {e}")


async def main():
    parser = argparse.ArgumentParser(description="Streaming STT WebSocket Server")
    parser.add_argument("--port", type=int, default=6006)
    parser.add_argument("--encoder", required=True)
    parser.add_argument("--decoder", required=True)
    parser.add_argument("--joiner", required=True)
    parser.add_argument("--tokens", required=True)
    parser.add_argument("--num-threads", type=int, default=2)
    args = parser.parse_args()

    recognizer = create_recognizer(args)
    logger.info(f"Model loaded. Starting server on port {args.port}...")

    async def handler(websocket):
        logger.info(f"New client connected: {websocket.remote_address}")
        await handle_client(websocket, recognizer)
        logger.info(f"Client disconnected: {websocket.remote_address}")

    async with websockets.serve(handler, "0.0.0.0", args.port, max_size=10 * 1024 * 1024):
        logger.info(f"Server listening on ws://0.0.0.0:{args.port}")
        await asyncio.Future()  # Run forever


if __name__ == "__main__":
    asyncio.run(main())
