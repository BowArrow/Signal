"""Interactive local login. Never print or pass the token in process arguments."""
from huggingface_hub import login

print('Hugging Face sign-in. Enter your read token at the hidden prompt.')
print('Tokens: https://huggingface.co/settings/tokens')
login(add_to_git_credential=False, skip_if_logged_in=False)
input('Sign-in complete. Press Enter to close, then tell Codex you are ready.')
