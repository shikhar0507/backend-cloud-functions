# Updating An Existing Template

endpoint: `/api/services/templates/update`

method: `PUT`

query parameter: none

## Full Request Body

```json
{
    "field1": "value1",
    "field2": "value2"
}
```

* Just send those fields in the request body which you want to `update`/`add` to the template.

* You can view the allowed fields in the [create template](./create.md) doc.

* You can omit the fields which do not require an update.

* Updating the `name` of the template is not allowed once created.
