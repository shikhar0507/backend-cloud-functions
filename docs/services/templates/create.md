# Creating A Template

endpoint: `/api/services/templates/create`

method: `POST`

query parameters: none

## Full Request Body

```json
{
    "name": "test template",
    "defaultTitle": "test template title",
    "comment": "Comment explaining what this template does.",
    "schedule": {
        "name": "schedule name",
        "startTime": 1527658692126,
        "endTime": 1527658707162
    },
    "venue": {
        "venueDescriptor": "descriptor of the venue",
        "location": "location of the venue",
        "geopoint": {
            "latitude": 20.20,
            "longitude": 100.100
        },
        "address": "address of the venue"
    },
    "attachment": {
        "key": "value"
    }
}
```

## Preconditions

* The requester needs to have the `manageTemplate` customClaim in their `idToken`.

* Template `name` should be unique. So, while creating an activity, the if an activity with the `name` from your request body already exists, your request will be rejected.
