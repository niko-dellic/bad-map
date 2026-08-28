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

Use Node 20.19 or Node 24 with npm. The repository's `packageManager` field
records the maintainer toolchain; CI verifies both Node lines, while the full
browser and packed-package checks run on Node 24.

```sh
npm ci
npx playwright install chromium chrome firefox webkit
npm run verify
npm run test:e2e:functional
```

Run `npm run dev` for the demonstration app. The full `npm run test:e2e`
command also runs visual comparisons and may require an intentional baseline
update when rendering changes.

Run a focused unit file with `npx vitest run path/to/file.test.ts`. Run a focused
browser test with `npx playwright test path/to/file.spec.ts -g "test name"`.
When a visual change is intentional, review the rendered image before running
`npx playwright test e2e/visual.spec.ts --update-snapshots`; visual baselines are
platform-specific.

### README gallery

The README feature gallery is generated from the live demo at a fixed
1200 × 750 viewport. Regenerate and validate it with:

```sh
npm run docs:capture-gallery
npm run docs:check-gallery
```

The capture command needs network access to OpenFreeMap and the public sample
datasets. Review every resulting image before committing `docs/media/gallery`;
the harness intentionally hides demo chrome and disables fog, vignette, and
fisheye while retaining map-data attribution.

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
