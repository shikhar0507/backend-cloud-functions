# Reading The Activities

endpoint: `/api/read`

method: `GET`

query parameter: `from=number`

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

This is the response that you will get when there are no activities found for the `timestamp` that you sent in the `from` query parameter in the url.

## Full Response Body

```json
{
    "addendum": [
        {
            "addendumId": "FzDVwbe8DCfBZPjlXwMH",
            "activityId": "MlYKQOFm61BbTidikBar",
            "comment": "+919090909090 created plan",
            "timestamp": "2018-06-24T13:17:40.677Z",
            "location": {
                "_latitude": 28.5821193,
                "_longitude": 77.3179443
            },
            "user": "+919090909090"
        },
        {
            "addendumId": "NIUm8JEwNTlYLePZUxqW",
            "activityId": "BGC8QvF1AZWCxGK2KHEj",
            "comment": "+919090909090 created plan",
            "timestamp": "2018-06-24T13:17:40.677Z",
            "location": {
                "_latitude": 28.5821193,
                "_longitude": 77.3179443
            },
            "user": "+919090909090"
        },
        {
            "addendumId": "NOAlvQ5g3S38Xotjhoyg",
            "activityId": "IW5CVMBVSe6QqaOP49fn",
            "comment": "+919090909090 created plan",
            "timestamp": "2018-06-24T13:17:40.677Z",
            "location": {
                "_latitude": 28.5821193,
                "_longitude": 77.3179443
            },
            "user": "+919090909090"
        },
        {
            "addendumId": "R2PWamFKDKkTAH2Eouf0",
            "activityId": "03NWYZePpfKkPYTIpqFE",
            "comment": "+919090909090 created plan",
            "timestamp": "2018-06-24T13:17:40.677Z",
            "location": {
                "_latitude": 28.5821193,
                "_longitude": 77.3179443
            },
            "user": "+919090909090"
        },
        {
            "addendumId": "dr0sIPNvRBWI469xlHFv",
            "activityId": "gs83ufKv8ie2PhL9tsOV",
            "comment": "+919090909090 created plan",
            "timestamp": "2018-06-24T13:17:40.677Z",
            "location": {
                "_latitude": 28.5821193,
                "_longitude": 77.3179443
            },
            "user": "+919090909090"
        },
        {
            "addendumId": "nYLrFYxqfaCcXKA2zHha",
            "activityId": "WbHrla0Ha0Xc3SRPxPBL",
            "comment": "+919090909090 created plan",
            "timestamp": "2018-06-24T13:17:40.677Z",
            "location": {
                "_latitude": 28.5821193,
                "_longitude": 77.3179443
            },
            "user": "+919090909090"
        },
        {
            "addendumId": "AAzOj8gTSPCTJwoEYTUK",
            "activityId": "03NWYZePpfKkPYTIpqFE",
            "comment": "+919090909090 updated plan",
            "timestamp": "2018-06-26T20:45:35.469Z",
            "location": {
                "_latitude": 10.2,
                "_longitude": 30.393
            },
            "user": "+919090909090"
        },
        {
            "addendumId": "WRrTnPpSGn95Qhj2s7an",
            "activityId": "03NWYZePpfKkPYTIpqFE",
            "comment": "+919090909090 updated plan",
            "timestamp": "2018-06-26T20:45:35.469Z",
            "location": {
                "_latitude": 10.2,
                "_longitude": 30.393
            },
            "user": "+919090909090"
        },
        {
            "addendumId": "MZtEDXUWJJBTSplO8CKZ",
            "activityId": "BGC8QvF1AZWCxGK2KHEj",
            "comment": "+919090909090 updated plan",
            "timestamp": "2018-06-27T06:08:55.416Z",
            "location": {
                "_latitude": 0,
                "_longitude": 0
            },
            "user": "+919090909090"
        }
    ],
    "activities": [
        {
            "activityId": "IW5CVMBVSe6QqaOP49fn",
            "status": "PENDING",
            "canEdit": true,
            "schedule": [
                {
                    "endTime": "",
                    "startTime": "",
                    "name": "where"
                }
            ],
            "venue": [
                "when"
            ],
            "timestamp": "2018-06-24T13:17:40.677Z",
            "template": "plan",
            "title": "Hi there",
            "description": "This is the description",
            "office": "personal",
            "assignees": [
                "+919090909090"
            ],
            "attachment": {}
        },
        {
            "activityId": "MlYKQOFm61BbTidikBar",
            "status": "PENDING",
            "canEdit": true,
            "schedule": [
                {
                    "startTime": "",
                    "name": "where",
                    "endTime": ""
                }
            ],
            "venue": [
                {
                    "location": "location 1",
                    "venueDescriptor": "where",
                    "address": "address stuff",
                    "geopoint": {
                        "_latitude": 28.5821193,
                        "_longitude": 77.3179443
                    }
                },
                {
                    "location": "location 2",
                    "venueDescriptor": "where",
                    "address": "address stuff 2",
                    "geopoint": {
                        "_latitude": 28.5821193,
                        "_longitude": 77.3179443
                    }
                }
            ],
            "timestamp": "2018-06-24T13:17:40.677Z",
            "template": "plan",
            "title": "Hi there",
            "description": "This is the description",
            "office": "personal",
            "assignees": [
                "+919090909090"
            ],
            "attachment": {}
        },
        {
            "activityId": "WbHrla0Ha0Xc3SRPxPBL",
            "status": "PENDING",
            "canEdit": true,
            "schedule": [
                {
                    "endTime": "",
                    "startTime": "",
                    "name": "where"
                }
            ],
            "venue": [
                {
                    "venueDescriptor": "when",
                    "geopoint": {
                        "_latitude": 0,
                        "_longitude": 0
                    },
                    "address": "",
                    "location": ""
                }
            ],
            "timestamp": "2018-06-24T13:17:40.677Z",
            "template": "plan",
            "title": "Hi there",
            "description": "This is the description",
            "office": "personal",
            "assignees": [
                "+919090909090"
            ],
            "attachment": {}
        },
        {
            "activityId": "gs83ufKv8ie2PhL9tsOV",
            "status": "PENDING",
            "canEdit": true,
            "schedule": [
                {
                    "endTime": "",
                    "startTime": "",
                    "name": "where"
                }
            ],
            "venue": [
                {
                    "address": "",
                    "location": "",
                    "venueDescriptor": "when",
                    "geopoint": {
                        "_latitude": 0,
                        "_longitude": 0
                    }
                }
            ],
            "timestamp": "2018-06-24T13:17:40.677Z",
            "template": "plan",
            "title": "Hi there",
            "description": "This is the description",
            "office": "personal",
            "assignees": [
                "+919090909090"
            ],
            "attachment": {}
        },
        {
            "activityId": "03NWYZePpfKkPYTIpqFE",
            "status": "PENDING",
            "canEdit": true,
            "schedule": [
                {
                    "endTime": "",
                    "startTime": "",
                    "name": "where"
                }
            ],
            "venue": [
                {
                    "venueDescriptor": "when",
                    "geopoint": {
                        "_latitude": 0,
                        "_longitude": 0
                    },
                    "address": "",
                    "location": ""
                }
            ],
            "timestamp": "2018-06-26T20:45:35.469Z",
            "template": "plan",
            "title": "changed the title",
            "description": "This is the description",
            "office": "personal",
            "assignees": [
                "+919090909090"
            ],
            "attachment": {}
        },
        {
            "activityId": "BGC8QvF1AZWCxGK2KHEj",
            "status": "PENDING",
            "canEdit": true,
            "schedule": [
                {
                    "endTime": "2018-06-26T19:32:27.834Z",
                    "startTime": "2018-06-26T19:32:27.107Z",
                    "name": "when"
                },
                {
                    "startTime": "2018-06-26T19:32:52.466Z",
                    "name": "when",
                    "endTime": "2018-06-26T19:32:58.994Z"
                }
            ],
            "venue": [
                {
                    "venueDescriptor": "where",
                    "address": "NEW Address String",
                    "geopoint": {
                        "_latitude": 22.20202,
                        "_longitude": 30.404044
                    },
                    "location": "NEW Location String"
                },
                {
                    "location": "SECONDS LOCATION",
                    "venueDescriptor": "where",
                    "address": "SECOND ADDRESS",
                    "geopoint": {
                        "_latitude": 21.20202,
                        "_longitude": 36.404044
                    }
                }
            ],
            "timestamp": "2018-06-27T06:08:55.416Z",
            "template": "plan",
            "title": "Hi there",
            "description": "This is the description",
            "office": "personal",
            "assignees": [
                "+919090909090"
            ],
            "attachment": {}
        }
    ],
    "templates": [
        {
            "schedule": [
                "when"
            ],
            "venue": [
                "where"
            ],
            "template": "plan",
            "attachment": {},
            "office": "personal"
        }
    ],
    "from": "1970-01-01T00:00:01.000Z",
    "upto": "2018-06-27T06:08:55.416Z"
}
```

## Preconditions

None
