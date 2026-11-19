# Licence signing (licensing.tf). Kept in Git, unlike terraform.tfvars:
# every apply of this stack needs these values, or it would plan to remove
# the key (which prevent_destroy refuses). Decided 2026-11-19.
licence_signing_enabled = true
licence_key_spec        = "RSA_3072"

# Who may take on the licence-issuer role (MFA required).
licence_issuer_principals = [
  "arn:aws:iam::557690608274:user/VenkateshV",
]

# The only people who may disable the key or schedule its deletion (MFA required).
# Both have MFA (2026-11-19).
licence_key_custodians = [
  "arn:aws:iam::557690608274:user/VenkateshV",
  "arn:aws:iam::557690608274:user/Sai",
]

# The server may sign too (the operator Licences page, LICENCE_SIGNER=kms).
licence_server_signs = true
