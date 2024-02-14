interface GithubOrganization {
  login: string;
}

export async function verifyBelongingOrganization(
  token: string,
  organization: string
) {
  const response = (await fetch("https://api.github.com/user/orgs", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Hono",
    },
  }).then((res) => res.json())) as GithubOrganization[];

  return response.some((org) => org.login === organization);
}
