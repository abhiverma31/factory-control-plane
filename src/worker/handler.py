import json
import os
from datetime import datetime, timezone

import boto3


JOBS_TABLE = os.environ["JOBS_TABLE"]

dynamodb = boto3.resource("dynamodb")
jobs_table = dynamodb.Table(JOBS_TABLE)

ecs = boto3.client("ecs")

HARNESS_CLUSTER_ARN = os.environ["HARNESS_CLUSTER_ARN"]
HARNESS_TASK_DEFINITION = os.environ["HARNESS_TASK_DEFINITION"]
HARNESS_SUBNET_IDS = os.environ["HARNESS_SUBNET_IDS"].split(",")
HARNESS_SECURITY_GROUP_ID = os.environ["HARNESS_SECURITY_GROUP_ID"]
CONTROL_PLANE_URL = os.environ["CONTROL_PLANE_URL"]


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

        task_arn = start_harness_task(body)
        mark_sandbox_started(job_id, task_arn)

        print(json.dumps({"message": "Worker picked up job", "jobId": job_id, "taskArn": task_arn}))

    return {"batchItemFailures": []}


def start_harness_task(job):
    response = ecs.run_task(
        cluster=HARNESS_CLUSTER_ARN,
        taskDefinition=HARNESS_TASK_DEFINITION,
        launchType="FARGATE",
        count=1,
        networkConfiguration={
            "awsvpcConfiguration": {
                "subnets": HARNESS_SUBNET_IDS,
                "securityGroups": [HARNESS_SECURITY_GROUP_ID],
                "assignPublicIp": "ENABLED",
            }
        },
        overrides={
            "containerOverrides": [
                {
                    "name": "harness",
                    "environment": [
                        {"name": "JOB_ID", "value": job["jobId"]},
                        {"name": "WORKFLOW_ID", "value": job["workflowId"]},
                        {"name": "TITLE", "value": job["title"]},
                        {"name": "DESCRIPTION", "value": job["description"]},
                        {"name": "CONTROL_PLANE_URL", "value": CONTROL_PLANE_URL},
                        {"name": "CHANGE_MODE", "value": "codex"},
                    ],
                }
            ]
        },
    )

    failures = response.get("failures", [])
    if failures:
        raise RuntimeError(f"Failed to start harness task: {failures}")

    return response["tasks"][0]["taskArn"]


def mark_sandbox_started(job_id, task_arn):
    sandbox_started_at = utc_now()
    sandbox_started_event = {
        "type": "SANDBOX_STARTED",
        "timestamp": sandbox_started_at,
        "message": "Harness Fargate task started.",
        "taskArn": task_arn,
    }

    jobs_table.update_item(
        Key={"jobId": job_id},
        UpdateExpression="SET harnessTaskArn = :taskArn, updatedAt = :updatedAt, #events = list_append(#events, :events)",
        ExpressionAttributeNames={
            "#events": "events",
        },
        ExpressionAttributeValues={
            ":taskArn": task_arn,
            ":updatedAt": sandbox_started_at,
            ":events": [sandbox_started_event],
        },
    )


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
