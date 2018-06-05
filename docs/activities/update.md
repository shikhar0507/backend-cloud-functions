# Updating The Content of The Activity

endpoint: `/api/activities/update`

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
    "title": string --> updated title,
    "description": string --> updated description,
    "venue": [{
        "venueDescriptor": "where",
        "location": string --> location name,
        "geopoint": {latitude: number, longitude: number},
        "address": string --> address
    }],
    "schedule": [{
        "name": "when",
        "startTime": number --> unix timestamp,
        "endTime": number --> unix timestamp
    }]
}
```

## Minimal Request Body

```json
{

    "activityId": string --> activityId,
    "timestamp": number --> unix timestamp,
    "geopoint": {
        latitude: number,
        longitude: number
    },
}
```

## Preconditions

* An activity with the `activityId` from the request body must exist.

* You must have edit rights to the activity.

* You must be an assignee of the activity.
