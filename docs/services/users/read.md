# Reading User Profiles

endpoint: `/api/services/users/read`

method: `GET`

query parameter:

- `q` (optional)

- `superUser` (optional)

The `.../read` endpoint accepts an argument `q` which can either be an array or a single value containing the phone numbers of all the users you want to get the profiles of.

Note: The `+` character is represented by `%2B` in url encoded characters. Check out [W3Schools URL Encoding](https://www.w3schools.com/tags/ref_urlencode.asp) for more details.

example: single phone number `.../api/services/users/read?q=%2B919090909090`

## Response For A Single Phone Number

```json
{
    "+919090909090": {
        "photoURL": "https://example.com/photo.png",
        "displayName": "metallica",
        "lastSignInTime": ''
    }
}
```

example: multiple phone numbers: `.../api/services/users/read?q=%2B919090909090&q=%2B918080808080`

## Response For Multiple Phone Numbers

```json
{
    "+919090909090": {
        "photoURL": "https://example.com/photo.png",
        "displayName": "metallica",
        "lastSignInTime": ''
    },
    "+918080808080": {
        "photoURL": '',
        "displayName": '',
        "lastSignInTime": ''
    }
}
```

## View Custom Claims and User Metadata

> The `superUser` can also request the user's `metadata` and `customClaims`.

To create a request as a `superUser`, you can add the `superUser` query parameter along with the value `true` in the request URL.

example URL: `api/services/users/read?superUser=true&q=%2B919090909090&q=%2B918080808080`

The response body in such a case will look as follows:

```json
{
    "+919090909090": {
        "displayName": "metallica",
        "photoURL": "photoURL": "https://example.com/photo.png",
        "disabled": false,
        "metadata": {
            "lastSignInTime": "Sat, 09 Jun 2018 06:17:05 GMT",
            "creationTime": "Tue, 08 May 2018 17:09:31 GMT"
        },
        "customClaims": {
            "support": true,
            "templatesManager": false,
            "superUser": true
        }
    },
    "+918080808080": {
        "displayName": '',
        "photoURL": '',
        "disabled": false,
        "metadata": '',
        "customClaims": {}
    }
}
```
