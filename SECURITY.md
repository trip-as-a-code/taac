# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in **taac**, please report it privately using
[GitHub Security Advisories](https://github.com/trip-as-a-code/taac/security/advisories/new).

Please do not open public issues for security vulnerabilities.

## Confidential trip values

taac is designed so that confidential values (booking references, phone numbers, etc.) are referenced via
`{ secret: NAME }` in YAML and only resolved locally with `taac build --reveal`. If you find any path where secret
values could leak into built static sites, server responses, or logs, please treat it as a high-severity security issue.
