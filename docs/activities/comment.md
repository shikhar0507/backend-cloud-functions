# Adding a Comment to an Existing Activity

endpoint: `/api/activities/commennt`

method: `POST`

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
    "comment": string --> whatever the comment is
}
```

* An activity with the `activityId` from the request body must exist.

* You must be an assignee of the activity.
