# Creating an Activity

To create an activity, use the `/activities/create` endpoint.

endpoint: `/api/activities/create`

method: `POST`

query parameters: none

## Full Request Body

```json
{
    "template": string --> template name,
    "timestamp": number --> unix timestamp,
    "office": string --> office name,
    "geopoint": {
        latitude: number,
        longitude: number
    },
    "title": string --> activity title,
    "description": string --> activity description,
    "share": [multiple strings --> phone numbers of the assignees],
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
    "template": string --> template name,
    "timestamp": number --> unix timestamp,
    "office": string --> office name,
    "geopoint": {
        latitude: number,
        longitude: number
    },
}
```

A request with this body will create an activity with the requester as the only assignee with no title or description.

These are the fields which are __REQUIRED__ at LEAST to be present in the request body in order for your request to be accepted.