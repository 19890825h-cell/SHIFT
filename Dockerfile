FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=8080
ENV HOST=0.0.0.0

EXPOSE 8080

CMD ["sh", "-c", "gunicorn wsgi:app --bind 0.0.0.0:${PORT:-8080}"]
