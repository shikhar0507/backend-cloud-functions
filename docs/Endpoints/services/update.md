# Updating your own phone number

**ENDPOINT**: `/app/services/users/update`

**METHOD**: PATCH

Allowing the update of your own phone number while logged in should not allowed directly via the client.

Any request for this kind of update need to be done via this https endpoint.

## Sample phone number update request

Any request for updating the phone number needs to have a non-empty request body with only a single field `phoneNumber`.

This phone number should be a valid [E.164](https://en.wikipedia.org/wiki/E.164) string.

## Request Body

```json
{
  "phoneNumber": "+919090909090"
}
```

## Reponse

* `202`: ACCEPTED: Users's was updated successfully.

* `400`: BAD REQUEST: Either the endpoint was wrong or the phone number in the request body was not valid.

* `409`: CONFLICT: The phone number you sent in the request body already exists in the sytem.

* `500`: INTERNAL SERVER ERROR: Probably an issue with the cloud function. Please create an issue.
