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
            "activityId": "PjpM6B72sTb237BSvCbn",
            "comment": "+919090909090 created plan",
            "timestamp": "2018-05-26T11:57:55.126Z",
            "location": {
                "_latitude": 88,
                "_longitude": 100
            },
            "user": "+919090909090"
        },
        {
            "activityId": "X9aeGH7aXbjrn0T78CZy",
            "comment": "+919090909090 created plan",
            "timestamp": "2018-05-26T11:57:55.126Z",
            "location": {
                "_latitude": 0,
                "_longitude": 0
            },
            "user": "+919090909090"
        },
        {
            "activityId": "QbfQlx6Cqu0hrbMughNm",
            "comment": "Hello, this is a comment to the activity.",
            "timestamp": "2018-05-28T06:18:56.784Z",
            "location": {
                "_latitude": 20.232323,
                "_longitude": 22.23232
            },
            "user": "+919090909090"
        },
        {
            "activityId": "QbfQlx6Cqu0hrbMughNm",
            "comment": "+919090909090created plan",
            "timestamp": "2018-05-28T06:18:56.784Z",
            "location": {
                "_latitude": 20.232323,
                "_longitude": 22.23232
            },
            "user": "+919090909090"
        },
        {
            "activityId": "QbfQlx6Cqu0hrbMughNm",
            "comment": "Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s",
            "timestamp": "2018-05-28T06:26:34.616Z",
            "location": {
                "_latitude": 40.1395,
                "_longitude": 100.1213435
            },
            "user": "+919090909090"
        },
        {
            "activityId": "QbfQlx6Cqu0hrbMughNm",
            "comment": "It was popularised in the 1960s with the release of Letraset sheets containing Lorem Ipsum passages, and more recently with desktop publishing software like Aldus PageMaker including versions of Lorem Ipsum.",
            "timestamp": "2018-05-28T06:27:22.504Z",
            "location": {
                "_latitude": 10.10101,
                "_longitude": 44.55443
            },
            "user": "+919090909090"
        },
        {
            "activityId": "QbfQlx6Cqu0hrbMughNm",
            "comment": "If you are going to use a passage of Lorem Ipsum, you need to be sure there isn't anything embarrassing hidden in the middle of text.",
            "timestamp": "2018-05-28T06:30:28.943Z",
            "location": {
                "_latitude": 88.909,
                "_longitude": 70.101
            },
            "user": "+919090909090"
        },
        {
            "activityId": "QbfQlx6Cqu0hrbMughNm",
            "comment": "The standard chunk of Lorem Ipsum used since the 1500s is reproduced below for those interested. Sections 1.10.32 and 1.10.33 from de Finibus Bonorum et Malorum by Cicero are also reproduced in their exact original form, accompanied by English versions from the 1914 translation by H. Rackham.",
            "timestamp": "2018-05-28T06:32:49.672Z",
            "location": {
                "_latitude": 70.101833,
                "_longitude": 22.23234
            },
            "user": "+919090909090"
        }
    ],
    "activities": [
        {
            "activityId": "PjpM6B72sTb237BSvCbn",
            "canEdit": true,
            "schedule": {
                "when": {
                    "startTime": "2018-05-26T11:57:55.126Z",
                    "name": "when",
                    "endTime": "2018-05-26T12:14:01.135Z"
                }
            },
            "venue": {
                "venueDescriptor": "where",
                "geopoint": null,
                "address": null,
                "location": null
            },
            "timestamp": "2018-05-26T11:57:55.126Z",
            "template": "plan",
            "title": "activity without title",
            "description": "activity without title",
            "office": "personal",
            "assignees": [
                "+919090909090",
                "+919111119191",
                "+91990092900"
            ],
            "attachment": {}
        },
        {
            "activityId": "X9aeGH7aXbjrn0T78CZy",
            "canEdit": true,
            "schedule": {
                "endTime": null,
                "startTime": null,
                "name": "when"
            },
            "venue": {
                "venueDescriptor": "where",
                "geopoint": null,
                "address": null,
                "location": null
            },
            "timestamp": "2018-05-26T11:57:55.126Z",
            "template": "plan",
            "title": "activity 1",
            "description": "description of activity 1",
            "office": "personal",
            "assignees": [
                "+918527801093",
                "+919090909090",
                "+9199009900"
            ],
            "attachment": {}
        },
        {
            "activityId": "QbfQlx6Cqu0hrbMughNm",
            "canEdit": true,
            "schedule": {
                "when": {
                    "endTime": "2018-05-28T06:19:12.969Z",
                    "startTime": "2018-05-28T06:18:56.784Z",
                    "name": "when"
                }
            },
            "venue": {
                "location": null,
                "venueDescriptor": "where",
                "geopoint": null,
                "address": null
            },
            "timestamp": "2018-05-28T06:18:56.784Z",
            "template": "plan",
            "title": "Meeting title",
            "description": "Meeting description",
            "office": "personal",
            "assignees": [
                "+393512556080",
                "+4915224759336",
                "+919090909090"
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
                "venueDescriptor": "where",
                "geopoint": {
                    "_latitude": 28.612912,
                    "_longitude": 77.227321
                },
                "address": "Rajpath Marg, India Gate, New Delhi, Delhi 110001",
                "location": "India Gate"
            },
            "template": "plan",
            "status": "PENDING",
            "attachment": null
        }
    ],
    "from": "1970-01-01T00:00:00.000Z",
    "upto": "2018-05-28T06:32:49.672Z"
}
```

## Preconditions

None
