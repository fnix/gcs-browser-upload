# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.5] - 2019-09-29
### Added
- Ensures successfull file transmision by checking GCS response headers containing chunk and file checksums,
  re-transmitting chunks when they differ.

### Fixed
- SparkMD5 states was being saved/restored without cloning the structure, causing the values to be changed in unexpected
  ways and giving wrong checksum values.

## [1.0.4] - 2019-09-14
### Fixed
- The exponential backoff changed a bit the upload semantics, breaking the tests. This release maintains the pre-1.0.3
  semantics, making all green again!

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

[Unreleased]: https://github.com/fnix/gcs-browser-upload/compare/v1.0.5...HEAD
[1.0.5]: https://github.com/fnix/gcs-browser-upload/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/fnix/gcs-browser-upload/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/fnix/gcs-browser-upload/compare/1e4600fb4f117a6f997a3162a039e28e9686cf24...v1.0.3
