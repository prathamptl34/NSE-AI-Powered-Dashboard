#!/bin/bash

# monitoring_setup.sh - Automated GCP Monitoring Configuration
# Requires: gcloud CLI, project or editor permissions.

# 1. Configuration
PROJECT_ID=$(gcloud config get-value project)
SERVICE_NAME="stock-dashboard"
REGION="us-central1" # Update if deployed elsewhere
ALERT_EMAIL="your-email@example.com" # CHANGE THIS

# Fetch the Cloud Run URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --platform managed --region $REGION --format='value(status.url)')

if [ -z "$SERVICE_URL" ]; then
  echo "Error: Could not find Cloud Run URL for $SERVICE_NAME in $REGION."
  echo "Make sure the service is deployed first."
  exit 1
fi

HOST=$(echo $SERVICE_URL | sed -e 's/https:\/\///')

echo "Configuring monitoring for: $SERVICE_URL"

# 2. Create Uptime Check
gcloud monitoring uptime-check-configs create "Stock Dashboard Uptime Check" \
  --project=$PROJECT_ID \
  --resource-type="uptime_url" \
  --resource-labels="host=$HOST,project_id=$PROJECT_ID" \
  --path="/api/health" \
  --period="60s" \
  --timeout="10s" \
  --content-match="\"status\":\"streaming\""

# 3. Create Notification Channel
CHANNEL_JSON=$(gcloud monitoring channels create --display-name="Production Alerts" \
  --type="email" --labels="email_address=$ALERT_EMAIL" --format="json")

CHANNEL_ID=$(echo $CHANNEL_JSON | grep -oP '(?<="name": ")[^"]+')

# 4. Create Alerting Policy
cat <<EOF > alert_policy.json
{
  "displayName": "Stock Dashboard Offline",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "Uptime Check Failed",
      "conditionThreshold": {
        "filter": "resource.type=\"uptime_url\" AND resource.label.\"host\"=\"$HOST\" AND metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\"",
        "aggregations": [
          {
            "alignmentPeriod": "300s",
            "crossSeriesReducer": "REDUCE_COUNT_FALSE",
            "perSeriesAligner": "ALIGN_FRACTION_TRUE"
          }
        ],
        "comparison": "COMPARISON_GT",
        "thresholdValue": 1,
        "duration": "60s",
        "trigger": {
          "count": 1
        }
      }
    }
  ],
  "notificationChannels": ["$CHANNEL_ID"],
  "enabled": true
}
EOF

gcloud monitoring policies create --policy-from-json=alert_policy.json

# 5. Enable Error Reporting
gcloud services enable clouderrorreporting.googleapis.com

echo "--------------------------------------------------------"
echo "Monitoring Setup Complete!"
echo "Check: https://console.cloud.google.com/monitoring/uptime"
echo "Note: It may take a few minutes for the first check to run."
echo "--------------------------------------------------------"
