









demo_owner / DemoPass!234
demo_staff / DemoPass!234
demo_customer / DemoPass!234

## Owner account bootstrap (Django)

The backend includes a management command to create or update an owner account from environment variables.

Required environment variables:
- OWNER_USERNAME
- OWNER_EMAIL
- OWNER_PASSWORD

Optional environment variables:
- OWNER_FIRST_NAME
- OWNER_LAST_NAME

Run from the backend directory:

```bash
python manage.py create_owner_from_env
```

To force-reset the password for an existing owner:

```bash
python manage.py create_owner_from_env --force-password
```
