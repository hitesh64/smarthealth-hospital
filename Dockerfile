# Image for hosting the project on Render (or any Docker host): Apache + PHP 8.2 + mysqli.
# The database is external; its address comes from the DB_* environment variables (see config.php).
FROM php:8.2-apache

RUN docker-php-ext-install mysqli \
    && { echo "upload_max_filesize=10M"; echo "post_max_size=12M"; echo "expose_php=Off"; echo "display_errors=Off"; echo "log_errors=On"; } > /usr/local/etc/php/conf.d/app.ini

COPY . /var/www/html/

# doctor and medicine photos are written here by the web server
RUN mkdir -p /var/www/html/uploads/medicines && chown -R www-data:www-data /var/www/html/uploads

# Render tells the container which port to listen on through $PORT (80 when it is not set)
CMD ["sh", "-c", "sed -i \"s/^Listen 80$/Listen ${PORT:-80}/\" /etc/apache2/ports.conf && sed -i \"s/<VirtualHost \\*:80>/<VirtualHost *:${PORT:-80}>/\" /etc/apache2/sites-available/000-default.conf && exec apache2-foreground"]
