# Instructions for Shopify app reviewers (draft)

1. Install SpeedBoost and approve the plan on Shopify's plan page. On a
   development store the plan is created at no charge.
2. **Dashboard** shows setup status. Click **Enable** next to *App embed*:
   the theme editor opens with SpeedBoost selected under App embeds. Click
   **Save**. The dashboard then shows the embed as Active.
3. **Speed audit**: keep `/`, choose *Mobile*, click **Analyze**. An audit
   takes 20–60 seconds. If the store has a storefront password, the app
   warns that Lighthouse measured the password page.
4. **Speed boosters**: switch on a setting (for example *Lazy-load videos &
   embeds*), click **Save**, and open the storefront. Turning it off and
   saving removes the behaviour on the next page view.
5. **Theme audit**: choose a theme and click **Run theme audit**. The app
   reads the theme (read_themes only) and lists findings; where a Speed
   booster solves a finding it links to it. It never writes theme files or
   asks merchants to edit code.
6. **Image compressor**: open it, click **Preview** on an image, drag the
   slider to compare, then **Use compressed image on my store**. Open
   **Compression history** and click **Restore original** to undo.
7. **Setup guide**: pick a theme and use **Open theme editor** to switch
   the app embed on (deep link with `activateAppId`).
8. **Reports** lists completed audits with trends.

Uninstalling deletes the app's stored data. The app embed stops running
when the app is uninstalled.

Support contact for reviewers: <fill in support email>
