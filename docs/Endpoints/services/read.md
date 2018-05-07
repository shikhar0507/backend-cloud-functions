# Getting multiple user profiles from Auth

**ENDPOINT**: `/app/services/users/read`

**METHOD**: GET

## Usage

The `/read` endpoint accepts an argument `q` which can either be an array or a single argument consisting of phone numbers of all the users you want to get the profiles of.

**Note**: The `+` character is represented by %2B in url encoded characters. Check out [W3Schools URL Encoding](https://www.w3schools.com/tags/ref_urlencode.asp) for more details.

**Request**: single phone number `.../app/services/users/read?q=%2B9090909090`

**RESPONSE**

```json
{
    "code": 200,
    "message": [
        {
            "+918527801093": { // user who exists
                "photoUrl": "https://example.com/profile.png",
                "displayName": "First Last ",
                "lastSignInTime": null
            }
        }
    ]
}
```


**REQUEST**: multiple phone numbers `.../app/services/users/read?q=%2B9090909090&q=%2B8010101010`

**RESPONSE**:

```json
{
    "code": 200,
    "message": [
        {
            "+918527801093": { // user who exists
                "photoUrl": "https://example.com/profile.png",
                "displayName": "First Last ",
                "lastSignInTime": null
            }
        },
        {
            "+918527801000": {} // a user who doesn't exist in the system
        }
    ]
}
```

## Response Code

Regardless of whether your request was fulfilled or if there was an error, you will receive a response. Here are the ones which you should handle.

* `200`: OK: The request for fetching the data was successful.

* `400`: BAD REQUEST: The endpoint you hit was probably spelled wrong.

* `405`: METHOD NOT ALLOWED: Only `GET` method is allowed for `/read`.

* `500`: INTERNAL SERVER ERROR: Probably an issue with the cloud function. Please create an issue.
