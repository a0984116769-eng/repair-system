# Repository Guidelines

## Project Structure & Module Organization

This project is currently a requirements workspace for a small repair-request registration system. `報修需求筆記.txt` is the source of truth for scope, fields, permissions, and deliverables. No application code, tests, assets, or package configuration exists yet.

When implementation begins, group application code in `src/`, automated tests in `tests/`, static assets in `public/`, Supabase migrations and policies in `supabase/`, and user-facing documents in `docs/`. These are proposed locations; create them only when needed.

## Build, Test, and Development Commands

No build, development, lint, or test commands are configured. Do not assume `npm test` or `npm run build` works. When selecting a stack, document the exact dependency installation, local startup, build, and test commands in `README.md`, alongside required runtime versions.

## Coding Style & Naming Conventions

No language, formatter, or linter has been selected. Follow the chosen stack’s established conventions and commit its formatting configuration with the initial implementation. Use descriptive names, consistent indentation, and small modules. Preserve Traditional Chinese labels and the field meanings specified in the requirements. Avoid unrelated formatting changes.

## Testing Guidelines

No testing framework or coverage threshold exists. Add tests appropriate to the selected stack. Cover required-field validation, request creation, list display, automatic registration timestamps, and Supabase access policies. Verify anonymous users can insert and read records but cannot update or delete them. Document test naming and execution commands when introducing tests.

## Commit & Pull Request Guidelines

This directory has no Git metadata or commit history, so no existing commit convention can be inferred. If Git is initialized, use short, imperative subjects, such as `Add repair request form`. Keep changes focused. Pull requests should describe behavior, reference relevant requirements or issues, report validation performed, and include screenshots for UI changes.

## Security & Scope

Use fictional names and locations in all examples. Enable Supabase row-level security before exposing the frontend. Never commit service-role keys or other secrets. The current demo supports creation and listing only; login, status updates, and notifications remain unresolved requirements.
