FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app:/schat-core

WORKDIR /app

COPY safety_evaluator/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --requirement /tmp/requirements.txt \
    && groupadd --system schat \
    && useradd --system --gid schat --home-dir /app schat \
    && mkdir -p /schat-core/tools \
    && touch /schat-core/tools/__init__.py \
    && chown -R schat:schat /app /schat-core

COPY --chown=schat:schat safety_evaluator /app/safety_evaluator

USER schat

CMD ["python", "-m", "safety_evaluator.service"]
