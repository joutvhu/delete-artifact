# Delete Artifacts

This GitHub Action to delete artifacts from your build. This can be useful when you want to clean up artifacts that are no longer needed.

See also [upload-artifact](https://github.com/actions/upload-artifact).

## Usage

See [action.yml](action.yml)

## Delete a Single Artifact

```yaml
steps:
- uses: joutvhu/delete-artifact@v2
  with:
    name: my-artifact
```

## Delete Multiple Artifacts

Deleting multiple artifacts within a single action can be achieved by specifying each artifact name on a new line, this can improve performance when deleting more than one artifact.

```yaml
steps:
- uses: joutvhu/delete-artifact@v2
  with:
    name: |
      artifact-1
      artifact-2
```

## Delete All Artifacts

If you don't specify an artifact `name` this Action will be deleted all found artifacts

```yaml
steps:
- uses: joutvhu/delete-artifact@v2
```
