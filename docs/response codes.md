# Response Code

Occasionally, the API will give out responses in a way that you did not desire.

More often than not, this is probably an issue with the client side.

Unless the response code starts with 5xx, please make sure that your request is a valid type.

## API Responses

The clients will receive one of the following response code in the response along with a helpful message indicating what happened.

* ok: 200
* created: 201
* accepted: 202
* noContent: 204
* badRequest: 400
* unauthorized: 401
* forbidden: 403
* notFound: 404
* methodNotAllowed: 405
* conflict: 409
* internalServerError: 500
* notImplemented: 501

> Read more about [http response code](https://httpstatuses.com).
> For all the update related requests, the response body will be empty. The response code will be 204 (No Content).
