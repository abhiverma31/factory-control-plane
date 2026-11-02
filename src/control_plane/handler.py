import json
import uuid
import os
import boto3

from datetime import datetime, timezone
from pathlib import Path

JOBS_TABLE = os.environ["JOBS_TABLE"]
JOBS_QUEUE_URL = os.environ["JOBS_QUEUE_URL"]

dynamodb = boto3.resource("dynamodb")
jobs_table = dynamodb.Table(JOBS_TABLE)
sqs = boto3.client("sqs")

CORS_HEADERS = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
}
STATIC_DIR = Path(__file__).parent / "ui"
STATIC_ROUTES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "application/javascript; charset=utf-8"),
}

def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


WORKFLOWS = [
    {
        "workflowId": "feature-development",
        "name": "Feature development",
    },
    {
        "workflowId": "incident-investigation",
        "name": "Incident investigation",
    },
]

def lambda_handler(event, context):
    method = event.get("requestContext", {}).get("http", {}).get("method", "")
    path = event.get("rawPath") or event.get("path") or "/"

    if method == "OPTIONS":
        return empty_response(204)

    if method == "GET" and path in STATIC_ROUTES:
        return static_response(path)

    if method == "GET" and path == "/jobs":
        return list_jobs()
    
    if method == "POST" and path == "/jobs":
        return create_job(event)
    
    if method == "GET" and path.startswith("/jobs/"):
        parts = path.strip("/").split("/")
        if len(parts) == 3 and parts[0] == "jobs" and parts[2] == "events":
            return get_job_events(parts[1])
        if len(parts) == 2 and parts[0] == "jobs":
            job_id = parts[1]
            return get_job(job_id)

    if method == "GET" and path == "/health":
        return json_response(200, {"ok": True})

    if method == "GET" and path == "/workflows":
        return json_response(200, {"workflows": WORKFLOWS})

    return json_response(404, {"message": "Not found"})

def create_job(event):
    body, error = parse_json_body(event)
    if error:
        return json_response(400, {"message": error})

    workflow_id = body.get("workflowId")
    title = body.get("title")
    description = body.get("description")

    if workflow_id not in {workflow["workflowId"] for workflow in WORKFLOWS}:
        return json_response(400, {"message": "Invalid workflowId"})

    if not isinstance(title, str) or not title.strip():
        return json_response(400, {"message": "title is required"})

    if not isinstance(description, str) or not description.strip():
        return json_response(400, {"message": "description is required"})
    
    now = utc_now()
    job = {
        "jobId": str(uuid.uuid4()),
        "workflowId": workflow_id,
        "title": title.strip(),
        "description": description.strip(),
        "status": "SUBMITTED",
        "createdAt": now,
        "updatedAt": now,
        "events": [
            {
                "type": "JOB_SUBMITTED",
                "timestamp": now,
                "message": "Job accepted by control plane.",
            }
        ],
    }

    jobs_table.put_item(Item=job)
    sqs.send_message(
        QueueUrl=JOBS_QUEUE_URL,
        MessageBody=json.dumps(
            {
                "jobId": job["jobId"],
                "workflowId": job["workflowId"],
            }
        ),
    )

    queued_at = utc_now()
    queued_event = {
        "type": "JOB_QUEUED",
        "timestamp": queued_at,
        "message": "Job sent to worker queue.",
    }

    jobs_table.update_item(
        Key={"jobId": job["jobId"]},
        UpdateExpression="SET #status = :status, updatedAt = :updatedAt, #events = list_append(#events, :events)",
        ExpressionAttributeNames={
            "#status": "status",
            "#events": "events",
        },
        ExpressionAttributeValues={
            ":status": "QUEUED",
            ":updatedAt": queued_at,
            ":events": [queued_event],
        },
    )

    job["status"] = "QUEUED"
    job["updatedAt"] = queued_at
    job["events"].append(queued_event)

    return json_response(202, job)

def list_jobs():
    result = jobs_table.scan(Limit=50)
    jobs = result.get("Items", [])

    jobs.sort(key=lambda job: job.get("createdAt", ""), reverse=True)

    summaries = []
    counts = {
        "all": len(jobs),
        "queued": 0,
        "active": 0,
        "failed": 0,
        "succeeded": 0,
    }

    for job in jobs:
        status = job.get("status", "")
        events = job.get("events", [])
        latest_event = events[-1] if events else {}

        if status == "QUEUED":
            counts["queued"] += 1
        elif status == "PICKED_UP":
            counts["active"] += 1
        elif status == "FAILED":
            counts["failed"] += 1
        elif status == "ACKNOWLEDGED":
            counts["succeeded"] += 1

        summaries.append(
            {
                "jobId": job.get("jobId"),
                "workflowId": job.get("workflowId"),
                "title": job.get("title"),
                "status": status,
                "createdAt": job.get("createdAt"),
                "updatedAt": job.get("updatedAt"),
                "latestEventType": latest_event.get("type"),
                "latestEventMessage": latest_event.get("message"),
            }
        )

    return json_response(200, {"jobs": summaries, "counts": counts})

def get_job(job_id):
    response = jobs_table.get_item(Key={"jobId": job_id})
    item = response.get("Item")

    if not item:
        return json_response(404, {"message": "Job not found"})

    return json_response(200, item)

def get_job_events(job_id):
    response = jobs_table.get_item(Key={"jobId": job_id})
    item = response.get("Item")

    if not item:
        return json_response(404, {"message": "Job not found"})

    return json_response(
        200,
        {
            "jobId": job_id,
            "events": item.get("events", []),
        },
    )


def parse_json_body(event):
    raw_body = event.get("body") or ""

    try:
        body = json.loads(raw_body)
    except json.JSONDecodeError:
        return None, "Request body must be valid JSON"

    if not isinstance(body, dict):
        return None, "Request body must be a JSON object"

    return body, None

def json_response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "content-type": "application/json",
            **CORS_HEADERS,
        },
        "body": json.dumps(body),
    }

def static_response(path):
    filename, content_type = STATIC_ROUTES[path]
    return {
        "statusCode": 200,
        "headers": {
            "content-type": content_type,
            **CORS_HEADERS,
        },
        "body": (STATIC_DIR / filename).read_text(encoding="utf-8"),
    }

def empty_response(status_code):
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": "",
    }
