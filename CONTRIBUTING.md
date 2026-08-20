# Contributing to bad-map

Thanks for helping improve `bad-map`. Bug reports, focused feature proposals,
documentation fixes, tests, and implementation work are welcome.

## Before opening an issue

- Search existing issues and the [project roadmap](./docs/NEXT_STEPS.md) for
  related work.
- Use a minimal reproduction for rendering or integration bugs.
- Include the browser, operating system, MapLibre version, projection mode,
  relevant package options, and the smallest data sample that reproduces the
  problem.
- Do not report security vulnerabilities publicly; follow `SECURITY.md`.

## Local development

Use a supported Node.js release (Node 20.19 or newer) and npm.

```sh
npm ci
npx playwright install chromium chrome
npm run verify
npm run test:e2e:functional
```

Run `npm run dev` for the demonstration app. The full `npm run test:e2e`
command also runs visual comparisons and may require an intentional baseline
update when rendering changes.

## Pull requests

- Keep each pull request focused and explain its user-visible behavior.
- Add or update unit and browser tests in proportion to the change.
- Preserve public types and document intentional API changes in `CHANGELOG.md`.
- Keep package-owned overlays outside basemap greyscale processing and below
  the label boundary unless an API change explicitly says otherwise.
- Avoid private MapLibre APIs and main-thread semantic rasterization.
- Do not commit generated `dist`, Playwright reports, or local test artifacts.

By participating, you agree to engage respectfully and constructively. Project
maintainers may edit or remove disruptive content and restrict participation
when necessary to keep the project welcoming and technically productive.
