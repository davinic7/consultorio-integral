<?php
$_SESSION = [];
session_destroy();
redir('login');
