# Reading The Activities

endpoint: `/api/activities/read`

method: `GET`

query parameter: `from=number --> unix timestamp`

example: `/api/activities/read?from=1522598642000`

## Minimum Response Body

```json
{
    "addendum": [],
    "activities": [],
    "templates": [],
    "from": "2018-05-28T06:32:49.672Z",
    "upto": "2018-05-28T06:32:49.672Z"
}
```
This is the response that you will get when there are no activities found for the timestamp that you sent in the request parameter.


## Full Response Body

```json
{
    "addendum": [
        {
            "activityId": "rthbw93Sc3YpAHbRAYFL",
            "comment": "+919090909090 created plan",
            "timestamp": "2018-06-05T16:46:09.484Z",
            "location": {
                "_latitude": 20,
                "_longitude": 100
            },
            "user": "+919090909090"
        },
        {
            "activityId": "PT9CZbAlV2dKxRBILBYX",
            "comment": "+919090909090 created plan",
            "timestamp": "2018-06-05T16:46:09.484Z",
            "location": {
                "_latitude": 20,
                "_longitude": 100
            },
            "user": "+919090909090"
        },
        {
            "activityId": "PT9CZbAlV2dKxRBILBYX",
            "comment": "+919090909090 updated plan",
            "timestamp": "2018-06-05T16:46:09.484Z",
            "location": {
                "_latitude": 20,
                "_longitude": 100
            },
            "user": "+919090909090"
        },
        {
            "activityId": "PT9CZbAlV2dKxRBILBYX",
            "comment": "+919090909090 updated plan",
            "timestamp": "2018-06-05T17:13:47.569Z",
            "location": {
                "_latitude": 80,
                "_longitude": 90
            },
            "user": "+919090909090"
        },
        {
            "activityId": "rthbw93Sc3YpAHbRAYFL",
            "comment": "+919090909090 updated plan",
            "timestamp": "2018-06-05T17:19:51.032Z",
            "location": {
                "_latitude": 80,
                "_longitude": 90
            },
            "user": "+919090909090"
        }
    ],
    "activities": [
        {
            "activityId": "PT9CZbAlV2dKxRBILBYX",
            "canEdit": true,
            "schedule": [
                {
                    "endTime": "2018-06-05T16:57:31.435Z",
                    "startTime": "2018-06-05T16:57:20.557Z",
                    "name": "when"
                }
            ],
            "venue": [
                {
                    "venueDescriptor": "where",
                    "geopoint": null,
                    "address": null,
                    "location": null
                },
                {
                    "venueDescriptor": "where",
                    "geopoint": {
                        "_latitude": 28.5482662,
                        "_longitude": 77.2117732
                    },
                    "address": "4/2, PHD House, August Kranti Marg, Siri Institutional Area, Block A, Nipccd Campus, Siri Institutional Area, New Delhi, Delhi 110016",
                    "location": "New Delhi, Delhi 110016"
                }
            ],
            "timestamp": "2018-06-05T17:13:47.569Z",
            "template": "plan",
            "title": "an activity with title.",
            "description": "activity with description",
            "office": "personal",
            "assignees": [
                "+918101010101",
                "+919090909090"
            ],
            "attachment": {}
        },
        {
            "activityId": "rthbw93Sc3YpAHbRAYFL",
            "canEdit": true,
            "schedule": [
                {
                    "endTime": "2018-06-05T16:57:31.435Z",
                    "startTime": "2018-06-05T16:57:20.557Z",
                    "name": "when"
                }
            ],
            "venue": [
                {
                    "location": "location name",
                    "venueDescriptor": "where",
                    "geopoint": {
                        "_latitude": 20,
                        "_longitude": 100
                    },
                    "address": "address string"
                },
                {
                    "venueDescriptor": "where",
                    "geopoint": {
                        "_latitude": 22,
                        "_longitude": 90
                    },
                    "address": "1 address string",
                    "location": "2 location name"
                }
            ],
            "timestamp": "2018-06-05T17:19:51.032Z",
            "template": "plan",
            "description": "",
            "office": "personal",
            "assignees": [
                "+918101010101",
                "+919090909090",
                "+918787878787"
            ],
            "attachment": {}
        }
    ],
    "templates": [
        {
            "schedule": {
                "endTime": "1999-12-31T18:30:00.000Z",
                "startTime": "1999-12-31T18:30:00.000Z",
                "name": "when"
            },
            "venue": {
                "location": "India Gate",
                "venueDescriptor": "where",
                "geopoint": {
                    "_latitude": 28.612912,
                    "_longitude": 77.227321
                },
                "address": "Rajpath Marg, India Gate, New Delhi, Delhi 110001"
            },
            "template": "plan",
            "status": "PENDING",
            "attachment": null
        }
    ],
    "from": "1970-01-01T00:00:00.000Z",
    "upto": "2018-06-05T17:19:51.032Z"
}
```

## Preconditions

None
