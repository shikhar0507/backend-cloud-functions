# Changing The Current Status of An Existing Activity

endpoint: `/api/activities/change-status`

method: `PATCH`

```json
{
    "activityId": string --> activityId,
    "timestamp": number --> unix timestamp,
    "geopoint": {
        latitude: number,
        longitude: number
    },
    "status": string --> a valid status
}
```

## Precondition

* An activity with the `activityId` from the request body must exist.

* You must have edit rights to the activity.

* You must be an assignee of the activity.
