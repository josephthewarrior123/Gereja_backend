# Firebase Church Journal Backend

## Firestore Collections

### `users/{uid}`
- `name: string`
- `email: string`
- `phone_number: string`
- `role: "super_admin" | "admin" | "user"`
- `groups: string[]` (`ranting`, `pemuda`)
- `managed_groups: string[]` (admin only)
- `is_active: boolean`
- `created_at: ISO string`
- `updated_at: ISO string`

### `admin_permissions/{adminUid}`
- `admin_id: string`
- `manage_ranting: boolean`
- `manage_pemuda: boolean`
- `updated_at: ISO string`

### `activities/{activityId}`
- `name: string`
- `points: number`
- `groups: string[]`
- `fields: array<object>`
- `created_by_admin: string`
- `is_active: boolean`
- `created_at: ISO string`
- `updated_at: ISO string`

### `journal_entries/{entryId}`
- `user_id: string`
- `user_groups: string[]`
- `activity_id: string`
- `activity_name_snapshot: string`
- `data: object`
- `timestamp: ISO string`
- `submitted_at: ISO string`
- `submitted_by: string`
- `points_awarded: number`
- `status: "approved"`

### `points_ledger/{ledgerId}`
- `user_id: string`
- `entry_id: string`
- `points_delta: number`
- `reason: string`
- `created_at: ISO string`

### `user_stats/{uid}`
- `user_id: string`
- `total_points: number`
- `entry_count: number`
- `updated_at: ISO string`

### `bible_books/{bookId}`
- `name: string`
- `name_lc: string`
- `total_chapters: number`
- `aliases: string[]`

## API Endpoints

All protected routes require Firebase ID Token:

`Authorization: Bearer <id_token>`

### Public authenticated
- `GET /api/me`
- `GET /api/activities`

### Super Admin only
- `POST /api/super-admin/admins`
- `PATCH /api/super-admin/admins/:uid/permissions`

### Admin or Super Admin
- `POST /api/admin/users`
- `POST /api/admin/activities`
- `PATCH /api/admin/activities/:activityId`

### Journal
- `POST /api/journal/entries`
- `GET /api/journal/my-entries`
- `GET /api/journal/groups/:group/entries` (admin/super_admin)

## Dynamic Activity Fields Example

```json
[
  { "name": "book", "type": "dropdown", "required": true, "source": "bible_books" },
  { "name": "chapter", "type": "number", "required": true, "min": 1 }
]
```

## Submit Journal Example

`POST /api/journal/entries`

```json
{
  "activity_id": "abc123",
  "timestamp": "2026-03-07T12:00:00.000Z",
  "data": {
    "book": "Genesis",
    "chapter": 10
  }
}
```

If chapter exceeds the selected Bible book max chapters, request is rejected.
