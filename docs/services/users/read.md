# Reading User Profiles

endpoint: `/api/services/read`

method: `GET`

query parameter: `q`

The `.../read` endpoint accepts an argument `q` which can either be an array or a single value containing the phone numbers of all the users you want to get the profiles of.

Note: The `+` character is represented by `%2B` in url encoded characters. Check out [W3Schools URL Encoding](https://www.w3schools.com/tags/ref_urlencode.asp) for more details.

example: single phone number `.../api/services/users/read?q=%2B9090909090`

## Response For A Single Phone Number

```json
{
    {
        "code": 200,
        "isSuccessful": true,
        "message": [{
                "+918090909090": {
                    "photoUrl": "https://example.com/profile.png",
                    "displayName": string --> first + last name,
                    "lastSignInTime": string --> timestamp
                }
            }
        ]
    }
}
```

example: multiple phone numbers: `.../api/services/users/read?q=%2B9090909090&q=%2B8010101010`

## Response For Multiple Phone Numbers

```json
{
    "code": 200,
    "message": [
        {
            "+918090909090": { // user who exists
                "photoUrl": "https://example.com/profile.png",
                "displayName": string --> first + last name,
                "lastSignInTime": string --> timestamp
            }
        },
        {
            "+919191919191": {} // a user who doesn't exist in the system
        }
    ]
}
```
