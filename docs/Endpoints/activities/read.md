# Reading updates and activities

**ENDPOINT**: `/app/activities/read`

**METHOD**: GET

## Example Response

```json
{
    "addendum": [
        {
            "activityId": "zE52PotR1u94AmVcnqal",
            "comment": "+919999999999 created Plan",
            "timestamp": "2018-03-02T18:30:00.000Z",
            "location": [
                80.2333,
                30.3434
            ],
            "user": "+919999999999"
        },
        {
            "activityId": "r6saWivwkM5QQZXfLdVg",
            "comment": "+918000000000 created Plan",
            "timestamp": "2018-03-02T18:30:00.000Z",
            "location": [
                80.2333,
                30.3434
            ],
            "user": "+918000000000"
        }
    ],
    "activities": {
        "6EDaPe5BNjcJ0qQKLCg1": {
            "canEdit": true,
            "status": "PENDING",
            "schedule": {},
            "venue": {},
            "timestamp": "2018-04-01T16:04:02.000Z",
            "template": "plan",
            "title": "new updated title",
            "description": "new changed description",
            "office": "personal",
            "assignTo": [
                "+918000000000",
                "+918111111111",
                "+919999999999",
            ]
        },
        "bgDIrjQPi5pN9Ph3qNZf": {
            "canEdit": true,
            "status": "PENDING",
            "schedule": {},
            "venue": {},
            "timestamp": "2018-05-06T17:06:43.718Z",
            "template": "plan",
            "title": "Title of the activity",
            "description": "Description of the activity.",
            "office": "personal",
            "assignTo": [
                "+918000000000",
                "+918111111111",
                "+919999999999",
            ]
        }
    },
    "templates": {
        "plan": {
            "schedule": {
                "endTime": "2018-04-25T06:29:54.401Z",
                "startTime": "2018-04-25T06:29:54.401Z",
                "name": "when"
            },
            "venue": {
                "address": "Rajpath Marg, India Gate, New Delhi 110001",
                "location": "India Gate",
                "venueDescriptor": "where",
                "geopoint": {
                    "_latitude": 28.612912,
                    "_longitude": 77.227321
                }
            },
            "template": "Plan",
            "comment": "Default template. Available to all users (group or not).",
            "status": "PENDING"
        }
    },
    "from": "1999-12-31T18:30:00.000Z",
    "upto": "2018-05-06T17:06:43.718Z"
}
```

## Fields

Most of the fields follow the same naming scheme as with `/create`, `/update` and `/comment` endpoints, explaination for each one would be redundant.

* **addendum**: An object contianing chronilogically ordered addendums (updates) starting from the time which was passed in the request.

* **from**: Timestamp denoting time from which the updates were fetched in the server.

* **upto**: Timestamp denoting the time up to which the updates were found in the database.

* **templates**: An object containing all the templates which the requester is allowed to create activities with.

## Query Parameters

The `/read` endpoint **requires** you to add a query paramter with with the unix timestamp denoting the time from which you want the updates in the response.

**example**: `.../read?from=1525170327665`

## Responses

Regardless of whether your request was fulfilled or if there was an error, you will receive a response. Here are the ones which you should handle.

* `200`: OK: The request for fetching the data was successful.

The endpoint at which you sent the request was not correct or the `from` query parameter does not constitute a valid unix timestamp.

* `400`: BAD REQUEST: The request endpoint was not implemented or the query paramter was omitted.

* `403`: FORBIDDEN: The requester doesn't have the authority to make the request.

* `405`: METHOD NOT ALLOWED: Only `GET` is allowed for `/read`.

* `500`: INTERNAL SERVER ERROR: Probably an issue with the cloud function. Please create an issue.
