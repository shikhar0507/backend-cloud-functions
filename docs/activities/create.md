# Creating an Activity

To create an activity, use the `/activities/create` endpoint.

endpoint: `/api/activities/create`

method: `POST`

query parameters: `support` (optional)

## Full Request Body

```json
{
    "template": "Template name",
    "office": "Office name",
    "timestamp": 1531896150395,
    "geopoint": {
        "latitude": 28.5482662,
        "longitude": 77.2030185
    },
    "title": "string",
    "description": "string",
    "share": ["+919090909090", "+918989898989"],
    "venue": [{
        "venueDescriptor": "venue name from template",
        "location": "location name",
        "geopoint": {
        "latitude": 28.5482662,
        "longitude": 77.2030185
        },
        "address": "address string"
    }],
    "schedule": [{
        "name": "schedule name from template",
        "startTime": 1531896457042,
        "endTime": 1531896457641
    }]
}
```

## Minimal Request Body

```json
{
    "template": "Template name",
    "office": "Office name",
    "timestamp": 1531896150395,
    "geopoint": {
        "latitude": 28.5482662,
        "longitude": 77.2030185
    }
}
```

A request with this body will create an activity with the requester as the only assignee with no title or description.

These are the fields which are __REQUIRED__ at LEAST to be present in the request body in order for your request to be accepted.
