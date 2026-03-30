# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.x     | :white_check_mark: |
| < 2.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in Phoebe, please report it responsibly:

1. **Do NOT open a public GitHub issue** for security vulnerabilities.
2. **Email** the maintainers or use [GitHub's private vulnerability reporting](https://github.com/muse-mesh/phoebe/security/advisories/new).
3. Include:
   - A description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix release**: As soon as practical, typically within 2 weeks

## Security Model

Phoebe runs with full bash access inside a Docker container. The security model
is designed to prevent the AI agent from:

- Modifying its own source code or configuration
- Running destructive system commands
- Exfiltrating secrets or credentials
- Performing network attacks
- Escaping the container

All security validations are enforced at the tool execution level and cannot be
overridden through prompt injection. See the [Security Model](README.md#security-model)
section in the README for details.
