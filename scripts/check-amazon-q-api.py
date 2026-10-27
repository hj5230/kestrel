"""Probe Amazon Q API-key discovery and generation without persisting credentials."""

import binascii
import getpass
import json
import os
import struct
import sys
import time
import urllib.error
import urllib.request
import uuid


ENDPOINT = "https://q.us-east-1.amazonaws.com/"


def decode_headers(data):
    headers = {}
    offset = 0
    while offset < len(data):
        name_length = data[offset]
        offset += 1
        name = data[offset:offset + name_length].decode("utf-8")
        offset += name_length
        value_type = data[offset]
        offset += 1
        if value_type == 7:
            length = struct.unpack_from(">H", data, offset)[0]
            offset += 2
            headers[name] = data[offset:offset + length].decode("utf-8")
            offset += length
        elif value_type in (0, 1):
            headers[name] = value_type == 0
        elif value_type in (2, 3, 4, 5, 8, 9):
            offset += {2: 1, 3: 2, 4: 4, 5: 8, 8: 8, 9: 16}[value_type]
        elif value_type == 6:
            length = struct.unpack_from(">H", data, offset)[0]
            offset += 2 + length
        else:
            raise ValueError("Unknown EventStream header type")
    return headers


def read_exact(response, size):
    result = bytearray()
    while len(result) < size:
        chunk = response.read(size - len(result))
        if not chunk:
            if not result:
                return None
            raise ValueError("Truncated EventStream frame")
        result.extend(chunk)
    return bytes(result)


def events(response):
    while True:
        prelude = read_exact(response, 12)
        if prelude is None:
            return
        total, header_length, crc = struct.unpack(">III", prelude)
        if not 16 <= total <= 16 * 1024 * 1024 or header_length > total - 16:
            raise ValueError("Invalid EventStream frame length")
        if binascii.crc32(prelude[:8]) != crc:
            raise ValueError("Invalid EventStream prelude checksum")
        rest = read_exact(response, total - 12)
        if rest is None:
            raise ValueError("Truncated EventStream frame")
        frame = prelude + rest
        if binascii.crc32(frame[:-4]) != struct.unpack(">I", frame[-4:])[0]:
            raise ValueError("Invalid EventStream message checksum")
        headers = decode_headers(frame[12:12 + header_length])
        payload = json.loads(frame[12 + header_length:-4])
        if headers.get(":message-type") in ("exception", "error"):
            raise ValueError("Amazon Q stream exception: " + json.dumps(payload))
        yield headers.get(":event-type", "unknown"), payload


def main():
    key = (os.environ.get("AMAZON_Q_API_KEY") or os.environ.get("KIRO_API_KEY") or getpass.getpass("Amazon Q API key (hidden): ")).strip()
    if not key:
        raise ValueError("An API key is required")

    def request(target, payload):
        request_id = str(uuid.uuid4())
        headers = {
            "Content-Type": "application/x-amz-json-1.0",
            "Authorization": "Bearer " + key,
            "tokentype": "API_KEY",
            "X-Amz-Target": target,
            "x-amzn-codewhisperer-optout": "true",
            "amz-sdk-invocation-id": request_id,
            "amz-sdk-request": "attempt=1; max=1",
            "x-amzn-kiro-agent-mode": "vibe",
        }
        req = urllib.request.Request(ENDPOINT, json.dumps(payload).encode(), headers)
        try:
            return urllib.request.urlopen(req, timeout=60)
        except urllib.error.HTTPError as error:
            detail = error.read(1200).decode("utf-8", "replace").replace(key, "[REDACTED]")
            raise RuntimeError(f"Amazon Q HTTP {error.code}: {detail}") from None

    started = time.monotonic()
    with request("AmazonCodeWhispererService.ListAvailableModels", {"origin": "AI_EDITOR"}) as response:
        models = json.load(response)
        print(json.dumps({"operation": "ListAvailableModels", "status": response.status,
                          "default": models.get("defaultModel", {}).get("modelId"),
                          "count": len(models.get("models", [])),
                          "models": [model.get("modelId") for model in models.get("models", [])]}), flush=True)
    available = [model["modelId"] for model in models.get("models", [])]
    if "claude-haiku-4.5" not in available:
        raise ValueError("The requested verification model is unavailable")
    payload = {
        "conversationState": {
            "chatTriggerType": "MANUAL", "agentTaskType": "vibe", "conversationId": str(uuid.uuid4()),
            "currentMessage": {"userInputMessage": {
                "content": "Reply with exactly: OK", "modelId": "claude-haiku-4.5", "origin": "AI_EDITOR"
            }},
        },
        "agentMode": "vibe",
        "inferenceConfig": {"maxTokens": 32},
    }
    contents = []
    event_types = []
    with request("AmazonCodeWhispererStreamingService.GenerateAssistantResponse", payload) as response:
        print(json.dumps({"operation": "GenerateAssistantResponse", "status": response.status,
                          "contentType": response.headers.get("content-type")}), flush=True)
        for event_type, event in events(response):
            event_types.append(event_type)
            if event_type == "assistantResponseEvent":
                contents.append(event.get("content", ""))
            print(json.dumps({"event": event_type, "data": event}, ensure_ascii=False), flush=True)
    answer = "".join(contents).strip()
    if answer != "OK":
        raise ValueError("Unexpected verification response: " + answer)
    print(json.dumps({"verified": True, "answer": answer, "events": event_types,
                      "seconds": round(time.monotonic() - started, 2)}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Verification failed: {error}", file=sys.stderr)
        sys.exit(1)
