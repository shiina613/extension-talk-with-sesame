FROM python:3.11-slim

RUN pip install --no-cache-dir sherpa-onnx websockets numpy

# Install wget and bzip2 for model download
RUN apt-get update && apt-get install -y --no-install-recommends wget bzip2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Download the streaming Zipformer model (int8 quantized)
RUN wget -q https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-en-2023-06-21.tar.bz2 \
    && tar xjf sherpa-onnx-streaming-zipformer-en-2023-06-21.tar.bz2 \
    && rm sherpa-onnx-streaming-zipformer-en-2023-06-21.tar.bz2

# Copy our minimal streaming server
COPY server.py .

EXPOSE 6006

CMD ["python", "server.py", \
     "--port=6006", \
     "--encoder=/app/sherpa-onnx-streaming-zipformer-en-2023-06-21/encoder-epoch-99-avg-1.int8.onnx", \
     "--decoder=/app/sherpa-onnx-streaming-zipformer-en-2023-06-21/decoder-epoch-99-avg-1.onnx", \
     "--joiner=/app/sherpa-onnx-streaming-zipformer-en-2023-06-21/joiner-epoch-99-avg-1.int8.onnx", \
     "--tokens=/app/sherpa-onnx-streaming-zipformer-en-2023-06-21/tokens.txt"]
