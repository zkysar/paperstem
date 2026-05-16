// Tiny module holding the sessionStorage key that anonymous viewers of
// /p/<token> stash before bouncing to /. Lives outside PublicProjectView
// so App.tsx can import it without pulling the whole public view tree
// into the authenticated bundle (which would defeat the lazy() split in
// main.tsx).
export const PUBLIC_RETURN_PATH_KEY = 'paperstem.public-return-path';
