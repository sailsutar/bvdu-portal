FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY ml-service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir \
      "fastapi>=0.110.0" \
      "uvicorn>=0.27.0" \
      "scikit-learn>=1.4.0" \
      "joblib>=1.3.0" \
      "pandas>=2.0.0" \
      "numpy>=1.26.0" \
      "openpyxl>=3.1.0" \
      "pydantic>=2.0.0" \
      "shap>=0.44.0" \
      "lightgbm>=4.0.0" \
      "transformers>=4.36.0" \
      "torch>=2.1.0" --index-url https://download.pytorch.org/whl/cpu

COPY ml-service/ ./

# Warm note: sentiment model downloads on first /sentiment call
ENV SENTIMENT_MODEL_ID=cardiffnlp/twitter-roberta-base-sentiment-latest
ENV TRANSFORMERS_CACHE=/app/.cache/huggingface

EXPOSE 8001
CMD ["uvicorn", "serve:app", "--host", "0.0.0.0", "--port", "8001"]
