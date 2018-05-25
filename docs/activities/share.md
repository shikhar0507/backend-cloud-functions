# Adding (assign) Someone To An Existing Activity

endpoint: `/api/activities/share`

method: `PATCH`

query parameter: none

## Full Request Body

```json
{
    "activityId": string --> activityId,
    "timestamp": number --> unix timestamp,
    "geopoint": {
        latitude: number,
        longitude: number
    },
    "share": [multiple strings --> phone numbers]
}
```

## Preconditions

* An activity with the `activityId` from the request body must exist.

* You must have edit rights to the activity.

* You must be an assignee of the activity.
