# Adding a Comment to an Existing Activity

endpoint: `/api/activities/commennt`

method: `POST`

query parameter: none

## Full Request Body

```json
{
    "activityId": "rthbw93Sc3YpAHbRAYFL",
    "timestamp": 1531896150395,
    "geopoint": {
        "latitude": 28.5482662,
        "longitude": 77.2030185
    },
    "comment": "A comment string."
}
```

## JS Object for this JSON

```js
const body = {
    activityId: 'rthbw93Sc3YpAHbRAYFL',
    timestamp: 0,
    geopoint: {
        latitude: 0,
        longitude: 0,
    },
    comment: 'A comment string.',
};
```

* An activity with the `activityId` from the request body must exist.

* You must be an assignee of the activity.
