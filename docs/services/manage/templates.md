# Managing Templates in the DB (for admins)

## Creating A Template

endpoint: `/api/services/manage/templates`

method: `PUT`

query parameters: none

## Full Request Body

```json
{
	"name": "test template",
	"defaultTitle": "test template",
	"comment": "test template for testing the api endpoint",
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
