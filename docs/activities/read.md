# Reading The Activities

endpoint: `/api/activities/read`

method: `GET`

query parameter: `from=number --> unix timestamp`

example: `/api/activities/read?from=1522598642000`

## Response Body

```json
{
  "addendum": [
      {
          "activityId": "JlHXNcDCuEM5t9cjdAgV",
          "comment": "+918527801093 created plan",
          "timestamp": "2018-03-02T18:30:00.000Z",
          "location": {
              "_latitude": 80.2333,
              "_longitude": 30.3434
          },
          "user": "+918527801093"
      },
      {
          "activityId": "nuSW5F3CD6gnSxcLd1Zq",
          "comment": "+918527801093 created plan",
          "timestamp": "2018-03-02T18:30:00.000Z",
          "location": {
              "_latitude": 80.2333,
              "_longitude": 30.3434
          },
          "user": "+918527801093"
      }
  ],
  "activities": {
      "NjefCchG5QH6vzvvaKyz": {
          "canEdit": true,
          "status": "CONFIRMED",
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
          "timestamp": "2018-05-25T07:09:39.896Z",
          "template": "plan",
          "title": "Hello world",
          "description": "from on-update.js",
          "office": "personal",
          "assignees": [
              "+918189090909",
              "+918527801093",
              "+919654766051",
              "91965470000",
              "919654766051"
          ],
          "attachment": {}
      },
      "nuSW5F3CD6gnSxcLd1Zq": {
          "canEdit": true,
          "status": "PENDING",
          "schedule": {},
          "venue": {},
          "timestamp": "2018-03-02T18:30:00.000Z",
          "template": "plan",
          "title": "Title of the activity",
          "description": "Description of the activity.",
          "office": "personal",
          "assignees": [
              "+918527801093"
          ],
          "attachment": {
            // stuff from attachment
          }
      }
  },
  "templates": {
      "plan": {
          "schedule": {
              "startTime": "1999-12-31T18:30:00.000Z",
              "name": "when",
              "endTime": "1999-12-31T18:30:00.000Z"
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
          "status": "PENDING"
      },
      "example template": {
        // example template data
      }
  },
  "from": "1999-12-31T18:30:00.000Z",
  "upto": "2018-05-25T07:09:39.896Z"
}
```

## Preconditions

None
