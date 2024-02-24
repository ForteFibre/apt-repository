import { Child, FC } from "hono/jsx";
import { installScript } from "./install-script";

const Layout: FC<{ children: Child }> = (props) => {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="stylesheet" href="https://unpkg.com/chota@latest" />
        <title>ForteFibre APT repository</title>
      </head>
      <body>
        <div class="container">{props.children}</div>
      </body>
    </html>
  );
};

export const Top: FC = () => {
  return (
    <Layout>
      <h1>Welcome to ForteFibre APT repository!</h1>
      <p>
        To access helper script or repository configuration, authenticate using
        GitHub.
      </p>
      <a class="button primary" href="/credentials">
        Access with GitHub
      </a>
    </Layout>
  );
};

export const Credentials: FC<{ username: string; password: string }> = ({
  username,
  password,
}) => {
  return (
    <Layout>
      <h1>Welcome to ForteFibre APT repository!</h1>
      <p>Here is your username and password to access the repository.</p>
      <pre>
        <code>
          Username: {username}
          {`\n`}
          Password: {password}
        </code>
      </pre>
      <p>
        But setting up with it is little complex, you can use this helper
        script.
      </p>
      <hr />
      <p>If you need to setup without helper, you may use this commands</p>
      <pre>
        <code>{installScript(username, password)}</code>
      </pre>
    </Layout>
  );
};
