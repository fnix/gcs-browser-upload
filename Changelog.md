# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unrelease]

## [1.0.3] - 2019-09-14
### Added
- Exponential backoff to retry failed chunk transmissions.
- Store SparkMD5 state, together with the chunk checksum, to localStorage so we can continue to calculate the file
  checksum without having to start from scratch. This also corrects a bug: the second time you started a resumable,
  a wrong checksum is calculated for the chunks uploaded in the first resume operation, discarding all the upload
  progress and starting from scratch.

### Changed
- Increase the transmission chunk size to 5mb.
- Only checks the two last uploaded chunks (10mb) before starting a resume operation.
