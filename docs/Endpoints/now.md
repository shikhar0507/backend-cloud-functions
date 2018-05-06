# Getting the server timestamp

**ENDPOINT**: `/app/now`

## Example response

```json
{
  "code": 200,
  "message": "Fri, 02 Mar 2018 18:30:00 GMT"
}
```

## Responses

Regardless of whether your request was fulfilled or if there was an error, you will receive a response. Here are the ones which you should handle.

* `200`: OK: The request was successful.

* `403`: FORBIDDEN: The requester doesn't have the authority to make the request.

* `405`: METHOD NOT ALLOWED: Only `GET` is allowed for `/now`.

* `500`: INTERNAL SERVER ERROR: Probably an issue with the cloud function. Please create an issue.
