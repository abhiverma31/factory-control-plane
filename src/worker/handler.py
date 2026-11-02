import json
import os
from datetime import datetime, timezone

import boto3


JOBS_TABLE = os.environ["JOBS_TABLE"]

dynamodb = boto3.resource("dynamodb")
jobs_table = dynamodb.Table(JOBS_TABLE)

def lambda_handler(event, context):
    for record in event.get("Records", []):
        body = json.loads(record.get("body") or "{}")
        job_id = body["jobId"]

        picked_up_at = utc_now()
        picked_up_event = {
            "type": "JOB_PICKED_UP",
            "timestamp": picked_up_at,
            "message": "Worker picked up job from queue.",
        }

        jobs_table.update_item(
            Key={"jobId": job_id},
            UpdateExpression="SET #status = :status, updatedAt = :updatedAt, #events = list_append(#events, :events)",
            ExpressionAttributeNames={
                "#status": "status",
                "#events": "events",
            },
            ExpressionAttributeValues={
                ":status": "PICKED_UP",
                ":updatedAt": picked_up_at,
                ":events": [picked_up_event],
            },
        )

        print(json.dumps({"message": "Worker picked up job", "jobId": job_id}))

    return {"batchItemFailures": []}

def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")