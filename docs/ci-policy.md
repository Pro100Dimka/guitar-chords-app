# CI execution policy

Builds and automated checks run for ready pull requests targeting `main`, and
for `main` itself. Work in progress should remain in a draft pull request.

| Event | Jobs may run |
| --- | --- |
| Push to `main` | Yes, subject to each workflow's existing path filters |
| Push to another branch | No |
| Ready pull request to `main`: opened, updated, reopened, or marked ready | Yes |
| Draft pull request | No |
| Pull request targeting another branch | No |
| Manual workflow dispatch on `main` | Yes |
| Manual workflow dispatch on another branch or tag | No |

The three PR workflows also receive `converted_to_draft` events. Their existing
workflow concurrency groups can cancel an older run while the new draft run's
jobs are skipped. A skipped run can still appear in Actions; it does not start
the build/test jobs.

All existing build commands, check names, dependencies and path filters are
retained. The full application audit and live chord-corpus audit remain manual.
Support-page publication also remains manual and is restricted to `main`;
this policy does not add automatic deployment.

Job-level conditions enforce this policy independently of event filters. When
a job already has a condition (such as the audit summary's `always()`), the
policy is combined with it using AND.
